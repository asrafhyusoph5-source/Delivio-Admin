import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { db, collection, getDocs, limit, query } from '../firebase';
import type { City } from '../types';

interface CityContextType {
  cities: City[];
  selectedCityId: string; // 'all' or city id
  selectedCity: City | null;
  setSelectedCityId: (id: string) => void;
  loadingCities: boolean;
  refreshCities: () => Promise<void>;
}

const CityContext = createContext<CityContextType | undefined>(undefined);

export const CityProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [cities, setCities] = useState<City[]>([]);
  const [selectedCityId, setSelectedCityIdState] = useState<string>(() => {
    return localStorage.getItem('delivio_admin_selected_city') || 'all';
  });
  const [loadingCities, setLoadingCities] = useState(true);

  const fetchCities = useCallback(async () => {
    try {
      setLoadingCities(true);
      const citiesRef = collection(db, 'cities');
      const q = query(citiesRef, limit(100));
      const snap = await getDocs(q);
      const list: City[] = [];
      snap.forEach((docSnap) => {
        const data = docSnap.data();
        list.push({
          id: docSnap.id,
          name: data.name || docSnap.id,
          province: data.province || '',
          status: data.status || 'active',
          center: data.center || { lat: 9.7392, lng: 118.7353 }, // default Puerto Princesa fallback
          radiusKm: Number(data.radiusKm) || 15,
          createdAt: data.createdAt || null
        });
      });
      // Sort in JavaScript as per instruction: "sort in JavaScript; never combine where with orderBy on another field"
      list.sort((a, b) => a.name.localeCompare(b.name));
      setCities(list);
    } catch (err) {
      console.error('Error fetching cities:', err);
    } finally {
      setLoadingCities(false);
    }
  }, []);

  useEffect(() => {
    fetchCities();
  }, [fetchCities]);

  const setSelectedCityId = (id: string) => {
    setSelectedCityIdState(id);
    localStorage.setItem('delivio_admin_selected_city', id);
  };

  const selectedCity = selectedCityId === 'all'
    ? null
    : cities.find((c) => c.id === selectedCityId) || null;

  return (
    <CityContext.Provider
      value={{
        cities,
        selectedCityId,
        selectedCity,
        setSelectedCityId,
        loadingCities,
        refreshCities: fetchCities
      }}
    >
      {children}
    </CityContext.Provider>
  );
};

export const useCity = () => {
  const context = useContext(CityContext);
  if (!context) {
    throw new Error('useCity must be used within a CityProvider');
  }
  return context;
};
