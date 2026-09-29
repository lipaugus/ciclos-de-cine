export default async function handler(req, res) {
  const { id } = req.query;

  if (!id) {
    return res.status(400).json({ error: 'Falta el parámetro id de la película' });
  }

  const apiKey = process.env.TMDB_API_KEY;

  if (!apiKey) {
    return res.status(500).json({ error: 'TMDB_API_KEY no está configurada en las variables de entorno de Vercel.' });
  }

  try {
    // Si la API key empieza con 'eyJ', es un Read Access Token (JWT / Bearer)
    const isBearer = apiKey.startsWith('eyJ');
    const headers = isBearer ? { Authorization: `Bearer ${apiKey}` } : {};
    const url = isBearer
      ? `https://api.themoviedb.org/3/movie/${id}?language=es-ES`
      : `https://api.themoviedb.org/3/movie/${id}?api_key=${apiKey}&language=es-ES`;

    const response = await fetch(url, { headers });

    if (!response.ok) {
      return res.status(response.status).json({ error: 'No se encontró la película en TMDB' });
    }

    const data = await response.json();

    // Guardar en caché de la CDN de Vercel por 24 horas para mayor velocidad
    res.setHeader('Cache-Control', 's-maxage=86400, stale-while-revalidate');
    return res.status(200).json(data);
  } catch (error) {
    return res.status(500).json({ error: 'Error interno del servidor' });
  }
}