const SPREADSHEET_ID = '1QXjX7o41PRM4mGq0IqWW0J2evxDioc7x8i9Us-kDZ0M';
const ALLOWED_SHEETS = new Set(['tabla', 'corrientes']);

export default async function handler(req, res) {
  const sheet = req.query.sheet;

  if (!ALLOWED_SHEETS.has(sheet)) {
    return res.status(400).json({ error: 'La hoja solicitada no es válida.' });
  }

  const url = `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(sheet)}`;

  try {
    const response = await fetch(url);

    if (!response.ok) {
      console.error(`Google Sheets respondió con HTTP ${response.status} para la hoja "${sheet}".`);
      return res.status(502).json({ error: 'No se pudo obtener la hoja desde Google Sheets.' });
    }

    const csv = await response.text();
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
    return res.status(200).send(csv);
  } catch (error) {
    console.error(`Error al obtener la hoja "${sheet}" desde Google Sheets:`, error);
    return res.status(502).json({ error: 'No se pudo conectar con Google Sheets.' });
  }
}
