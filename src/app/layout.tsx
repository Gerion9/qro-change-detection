import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Visualización de Cambios en la Cobertura del Suelo en Querétaro (2016-2024)',
  description: 'Mapa interactivo de cambios en cobertura de suelo — Blackprint Technologies',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <head>
        <link
          href="https://unpkg.com/maplibre-gl@3.6.2/dist/maplibre-gl.css"
          rel="stylesheet"
        />
        <link
          href="https://api.mapbox.com/mapbox-gl-js/plugins/mapbox-gl-geocoder/v4.7.0/mapbox-gl-geocoder.css"
          rel="stylesheet"
        />
        <link
          href="https://fonts.googleapis.com/css2?family=Roboto:wght@300;400;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}

