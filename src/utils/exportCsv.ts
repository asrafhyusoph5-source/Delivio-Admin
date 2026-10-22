export function exportToCsv(filename: string, rows: Record<string, any>[], customHeaders?: { key: string; label: string }[]) {
  if (!rows || !rows.length) {
    alert('No data to export');
    return;
  }

  let headers: { key: string; label: string }[] = [];
  if (customHeaders && customHeaders.length) {
    headers = customHeaders;
  } else {
    headers = Object.keys(rows[0]).map((key) => ({ key, label: key }));
  }

  const csvHeader = headers.map((h) => `"${h.label.replace(/"/g, '""')}"`).join(',');
  const csvRows = rows.map((row) => {
    return headers
      .map((h) => {
        let val = row[h.key];
        if (val === undefined || val === null) {
          val = '';
        } else if (typeof val === 'object') {
          if (val instanceof Date) {
            val = val.toISOString();
          } else if (val.seconds) {
            val = new Date(val.seconds * 1000).toISOString();
          } else {
            val = JSON.stringify(val);
          }
        }
        return `"${String(val).replace(/"/g, '""')}"`;
      })
      .join(',');
  });

  const csvContent = [csvHeader, ...csvRows].join('\r\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.setAttribute('href', url);
  link.setAttribute('download', `${filename.endsWith('.csv') ? filename : filename + '.csv'}`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
