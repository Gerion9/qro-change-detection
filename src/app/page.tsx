'use client';

import Script from 'next/script';
import { useEffect, useRef, useState } from 'react';

/* ─── CDN URLs para librerías del mapa ─── */
const MAPLIBRE_JS = 'https://unpkg.com/maplibre-gl@3.6.2/dist/maplibre-gl.js';
const PMTILES_JS  = 'https://unpkg.com/pmtiles@3.0.6/dist/pmtiles.js';
const TURF_JS     = 'https://unpkg.com/@turf/turf@6/turf.min.js';
const GEOCODER_JS = 'https://api.mapbox.com/mapbox-gl-js/plugins/mapbox-gl-geocoder/v4.7.0/mapbox-gl-geocoder.min.js';

const REQUIRED_SCRIPTS = 4;

const LOGO_URL = 'https://media.licdn.com/dms/image/v2/D560BAQE6I-jybXhV0A/company-logo_200_200/company-logo_200_200/0/1666159671955/blackprint_technologies_logo?e=2147483647&v=beta&t=FZZJP3dE_JKc1MbWb-pFa7iCn4W6u4f69MAcMvXwaPU';

export default function MapPage() {
  const [loadedScripts, setLoadedScripts] = useState(0);
  const mapInitialized = useRef(false);

  const onScriptLoad = () => setLoadedScripts((n) => n + 1);

  useEffect(() => {
    if (loadedScripts < REQUIRED_SCRIPTS || mapInitialized.current) return;
    mapInitialized.current = true;
    initMap();
  }, [loadedScripts]);

  return (
    <>
      {/* ─── Scripts CDN ─── */}
      <Script src={MAPLIBRE_JS} onLoad={onScriptLoad} strategy="afterInteractive" />
      <Script src={PMTILES_JS}  onLoad={onScriptLoad} strategy="afterInteractive" />
      <Script src={TURF_JS}     onLoad={onScriptLoad} strategy="afterInteractive" />
      <Script src={GEOCODER_JS} onLoad={onScriptLoad} strategy="afterInteractive" />

      {/* ─── Loading overlay ─── */}
      <div id="loading">
        <div className="spinner" />
        Cargando mapa...
      </div>

      {/* ─── Header ─── */}
      <div id="header">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img id="logo" src={LOGO_URL} alt="Blackprint Technologies Logo" />
        <h1 id="title">
          Visualización de Cambios en la Cobertura del Suelo en Querétaro (2016-2024)
        </h1>
      </div>

      {/* ─── Search ─── */}
      <div id="search" />

      {/* ─── Map container ─── */}
      <div id="map" />

      {/* ─── Menu panel ─── */}
      <div id="menu" className="panel">
        <div id="menu-toggle" />

        <h3>Capas</h3>
        <label><input type="checkbox" id="landcover2016" defaultChecked /> Cobertura del Suelo 2016</label>
        <label><input type="checkbox" id="landcover2024" /> Cobertura del Suelo 2024</label>
        <label><input type="checkbox" id="landcoverChange" /> Cambios en Cobertura del Suelo</label>
        <label><input type="checkbox" id="trees2016" /> Árboles Individuales 2016</label>
        <label><input type="checkbox" id="trees2024" /> Árboles Individuales 2024</label>
        <label><input type="checkbox" id="treeChange" /> Cambios en Árboles Individuales</label>
        <label><input type="checkbox" id="satellite2017" /> Imágenes Satelitales 2017</label>
        <label><input type="checkbox" id="satellite2024" /> Imágenes Satelitales 2024</label>

        <div id="satellite-opacity-control" style={{ display: 'none', marginTop: 10, marginBottom: 15 }}>
          <label htmlFor="satellite-opacity">Opacidad de imágenes satelitales:</label>
          <input type="range" id="satellite-opacity" min={0} max={100} defaultValue={70} style={{ width: '100%' }} />
          <span id="satellite-opacity-value">70%</span>
        </div>

        <h3>Categorías</h3>
        <label><input type="checkbox" id="filter-all" defaultChecked /> Todas las categorías</label>
        <label>
          <input type="checkbox" id="filter-impervious" defaultChecked />
          <span className="legend-color" style={{ backgroundColor: '#808080' }} />
          Superficie Impermeable
        </label>
        <label>
          <input type="checkbox" id="filter-bareland" defaultChecked />
          <span className="legend-color" style={{ backgroundColor: '#D2B48C' }} />
          Terreno descubierto
        </label>
        <label>
          <input type="checkbox" id="filter-shrub" defaultChecked />
          <span className="legend-color" style={{ backgroundColor: '#90EE90' }} />
          Arbustos
        </label>
        <label>
          <input type="checkbox" id="filter-forest" defaultChecked />
          <span className="legend-color" style={{ backgroundColor: '#006400' }} />
          Árboles
        </label>
        <label>
          <input type="checkbox" id="filter-grass" defaultChecked />
          <span className="legend-color" style={{ backgroundColor: '#9ACD32' }} />
          Pasto
        </label>
        <label>
          <input type="checkbox" id="filter-water" defaultChecked />
          <span className="legend-color" style={{ backgroundColor: '#0000FF' }} />
          Agua
        </label>

        <h3>Cambios</h3>
        <div className="legend-item">
          <span className="legend-color" style={{ backgroundColor: '#FFA500' }} />
          Añadido
        </div>
        <div className="legend-item">
          <span className="legend-color" style={{ backgroundColor: '#FF0000' }} />
          Removido
        </div>
      </div>

      {/* ─── Year slider ─── */}
      <div id="slider">
        <input type="range" min={2016} max={2024} defaultValue={2016} step={8} id="yearSlider" />
        <span id="yearDisplay">2016</span>
      </div>
    </>
  );
}

/* =========================================================================
 * initMap — toda la lógica de inicialización del mapa
 * (se ejecuta una vez después de que cargan todos los scripts CDN)
 * ========================================================================= */

function initMap() {
  /* Globals de los CDN */
  const maplibregl = (window as any).maplibregl;
  const pmtilesLib = (window as any).pmtiles;
  const turf       = (window as any).turf;
  const MapboxGeocoder = (window as any).MapboxGeocoder;

  const MAPBOX_TOKEN = 'pk.eyJ1IjoiZ2VyaW9uOSIsImEiOiJjbTg3dzVkOWkwamUwMndvcDBpY2Jjem9lIn0.q_eEy7Z60ddees6luj2xtg';

  /* ─── Registrar protocolo PMTiles ─── */
  const pmtilesProtocol = new pmtilesLib.Protocol();
  maplibregl.addProtocol('pmtiles', pmtilesProtocol.tile);

  /* ─── Base URL para las API routes (mismo origen) ─── */
  const origin = window.location.origin;

  /* ─── Crear mapa ─── */
  const map = new maplibregl.Map({
    container: 'map',
    style: 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json',
    center: [-100.3899, 20.5888],
    zoom: 13,
  });

  map.on('load', () => {
    // Ocultar loading
    const loadingEl = document.getElementById('loading');
    if (loadingEl) loadingEl.style.display = 'none';

    let currentSatelliteOpacity = 0.7;

    /* ─── Color matches ─── */
    const landcoverColorMatch = [
      'match', ['get', 'CateTitle'],
      'impervious',  '#808080',
      'bareland',    '#D2B48C',
      'bare_ground', '#D2B48C',
      'shrub',       '#90EE90',
      'forest',      '#006400',
      'grass',       '#9ACD32',
      'water',       '#0000FF',
      '#D2B48C',
    ];

    const changeColorMatch = [
      'match', ['get', 'Change'],
      'added',   '#FFA500',
      'removed', '#FF0000',
      '#D2B48C',
    ];

    /* =============================================================
     * FUENTES VECTORIALES — PMTiles via API proxy (mismo origen)
     *
     * Patrón: pmtiles:///api/pmtiles/{layer}
     * El API route hace proxy de Range requests desde GCS privado.
     * ============================================================= */

    const pmtilesLayers: [string, string, string][] = [
      ['landcover2016-source', 'landcover_2016', 'landcover_2016'],
      ['landcover2024-source', 'landcover_2024', 'landcover_2024'],
      ['landcoverChange-source', 'landcover_change', 'landcover_change'],
      ['trees2016-source', 'single_tree_2016', 'single_tree_2016'],
      ['trees2024-source', 'single_tree_2024', 'single_tree_2024'],
      ['treeChange-source', 'single_tree_change', 'single_tree_change'],
    ];

    for (const [sourceId, apiLayer, sourceLayer] of pmtilesLayers) {
      map.addSource(sourceId, {
        type: 'vector',
        url: `pmtiles://${origin}/api/pmtiles/${apiLayer}`,
      });
    }

    /* ─── Capas vectoriales ─── */

    map.addLayer({
      id: 'landcover2016-layer', type: 'fill',
      source: 'landcover2016-source', 'source-layer': 'landcover_2016',
      paint: { 'fill-color': landcoverColorMatch, 'fill-opacity': 0.7 },
      layout: { visibility: 'visible' },
    });

    map.addLayer({
      id: 'landcover2024-layer', type: 'fill',
      source: 'landcover2024-source', 'source-layer': 'landcover_2024',
      paint: { 'fill-color': landcoverColorMatch, 'fill-opacity': 0.7 },
      layout: { visibility: 'none' },
    });

    map.addLayer({
      id: 'landcoverChange-layer', type: 'fill',
      source: 'landcoverChange-source', 'source-layer': 'landcover_change',
      paint: { 'fill-color': changeColorMatch, 'fill-opacity': 0.9 },
      layout: { visibility: 'none' },
    });

    map.addLayer({
      id: 'trees2016-layer', type: 'fill',
      source: 'trees2016-source', 'source-layer': 'single_tree_2016',
      paint: { 'fill-color': '#006400', 'fill-opacity': 0.7 },
      layout: { visibility: 'none' },
    });

    map.addLayer({
      id: 'trees2024-layer', type: 'fill',
      source: 'trees2024-source', 'source-layer': 'single_tree_2024',
      paint: { 'fill-color': '#006400', 'fill-opacity': 0.7 },
      layout: { visibility: 'none' },
    });

    map.addLayer({
      id: 'treeChange-layer', type: 'fill',
      source: 'treeChange-source', 'source-layer': 'single_tree_change',
      paint: { 'fill-color': changeColorMatch, 'fill-opacity': 0.9 },
      layout: { visibility: 'none' },
    });

    /* =============================================================
     * FUENTES RASTER — COGs via API proxy /api/tile
     * ============================================================= */

    map.addSource('satellite2017-source', {
      type: 'raster',
      tiles: [`/api/tile?year=2017&z={z}&x={x}&y={y}`],
      tileSize: 256,
      minzoom: 10,
      maxzoom: 18,
    });
    map.addLayer({
      id: 'satellite2017-layer', type: 'raster',
      source: 'satellite2017-source',
      paint: { 'raster-opacity': currentSatelliteOpacity },
      layout: { visibility: 'none' },
    });

    map.addSource('satellite2024-source', {
      type: 'raster',
      tiles: [`/api/tile?year=2024&z={z}&x={x}&y={y}`],
      tileSize: 256,
      minzoom: 10,
      maxzoom: 18,
    });
    map.addLayer({
      id: 'satellite2024-layer', type: 'raster',
      source: 'satellite2024-source',
      paint: { 'raster-opacity': currentSatelliteOpacity },
      layout: { visibility: 'none' },
    });

    /* =============================================================
     * CONTROLES
     * ============================================================= */

    map.addControl(new maplibregl.NavigationControl(), 'bottom-right');

    const geocoder = new MapboxGeocoder({
      accessToken: MAPBOX_TOKEN,
      mapboxgl: maplibregl,
      placeholder: 'Buscar ubicación',
    });
    document.getElementById('search')?.appendChild(geocoder.onAdd(map));

    /* =============================================================
     * TOGGLE DE CAPAS
     * ============================================================= */

    function updateSatelliteOpacity(opacity: number) {
      currentSatelliteOpacity = opacity;
      const cb2017 = document.getElementById('satellite2017') as HTMLInputElement | null;
      const cb2024 = document.getElementById('satellite2024') as HTMLInputElement | null;
      if (cb2017?.checked)
        map.setPaintProperty('satellite2017-layer', 'raster-opacity', opacity);
      if (cb2024?.checked)
        map.setPaintProperty('satellite2024-layer', 'raster-opacity', opacity);
      const valEl = document.getElementById('satellite-opacity-value');
      if (valEl) valEl.textContent = `${Math.round(opacity * 100)}%`;
    }

    const toggleableLayerIds = [
      'landcover2016', 'landcover2024', 'landcoverChange',
      'trees2016', 'trees2024', 'treeChange',
      'satellite2017', 'satellite2024',
    ];

    toggleableLayerIds.forEach((layerId) => {
      const checkbox = document.getElementById(layerId) as HTMLInputElement | null;
      if (!checkbox) return;

      checkbox.onchange = function (e: Event) {
        e.preventDefault();
        e.stopPropagation();
        const el = e.target as HTMLInputElement;
        const mapLayerId = el.id + '-layer';
        map.setLayoutProperty(mapLayerId, 'visibility', el.checked ? 'visible' : 'none');

        if (layerId === 'satellite2017' || layerId === 'satellite2024') {
          const cb2017 = document.getElementById('satellite2017') as HTMLInputElement | null;
          const cb2024 = document.getElementById('satellite2024') as HTMLInputElement | null;
          const anyActive = cb2017?.checked || cb2024?.checked;
          const opCtrl = document.getElementById('satellite-opacity-control');
          if (opCtrl) opCtrl.style.display = anyActive ? 'block' : 'none';
        }
      };

      const initialVisibility = layerId === 'landcover2016' ? 'visible' : 'none';
      map.setLayoutProperty(layerId + '-layer', 'visibility', initialVisibility);
      checkbox.checked = initialVisibility === 'visible';
    });

    const opSlider = document.getElementById('satellite-opacity') as HTMLInputElement | null;
    if (opSlider) {
      opSlider.oninput = () => {
        updateSatelliteOpacity(parseInt(opSlider.value, 10) / 100);
      };
    }

    /* =============================================================
     * SLIDER DE AÑO
     * ============================================================= */

    const slider = document.getElementById('yearSlider') as HTMLInputElement | null;
    const yearDisplay = document.getElementById('yearDisplay');

    if (slider) {
      slider.oninput = () => {
        const year = parseInt(slider.value, 10);
        if (yearDisplay) yearDisplay.textContent = String(year);

        ['landcover', 'trees'].forEach((base) => {
          const show = base + (year === 2016 ? '2016' : '2024');
          const hide = base + (year === 2016 ? '2024' : '2016');
          map.setLayoutProperty(show + '-layer', 'visibility', 'visible');
          map.setLayoutProperty(hide + '-layer', 'visibility', 'none');
          const cbShow = document.getElementById(show) as HTMLInputElement | null;
          const cbHide = document.getElementById(hide) as HTMLInputElement | null;
          if (cbShow) cbShow.checked = true;
          if (cbHide) cbHide.checked = false;
        });

        ['landcoverChange', 'treeChange'].forEach((id) => {
          const cb = document.getElementById(id) as HTMLInputElement | null;
          if (cb) cb.checked = false;
          map.setLayoutProperty(id + '-layer', 'visibility', 'none');
        });

        updateFilters();
      };
    }

    /* =============================================================
     * FILTROS DE CATEGORÍA
     * ============================================================= */

    const categoryFilters = document.querySelectorAll<HTMLInputElement>('[id^="filter-"]');
    const allFilter = document.getElementById('filter-all') as HTMLInputElement | null;

    function updateFilters() {
      const selected: string[] = [];
      let allSelected = true;
      categoryFilters.forEach((f) => {
        if (f.id !== 'filter-all') {
          if (f.checked) selected.push(f.id.replace('filter-', ''));
          else allSelected = false;
        }
      });
      if (allFilter) allFilter.checked = allSelected;

      const layerIds = [
        'landcover2016-layer', 'landcover2024-layer', 'landcoverChange-layer',
        'trees2016-layer', 'trees2024-layer', 'treeChange-layer',
      ];
      layerIds.forEach((lid) => {
        map.setFilter(
          lid,
          selected.length === 0
            ? ['==', 'CateTitle', '']
            : ['in', 'CateTitle', ...selected],
        );
      });
    }

    categoryFilters.forEach((f) => {
      f.onchange = updateFilters;
    });

    if (allFilter) {
      allFilter.onchange = function () {
        categoryFilters.forEach((f) => {
          if (f.id !== 'filter-all') f.checked = allFilter!.checked;
        });
        updateFilters();
      };
    }

    /* =============================================================
     * POPUP AL HACER CLIC
     * ============================================================= */

    map.on('click', (e: any) => {
      const layers = [
        'landcover2016-layer', 'landcover2024-layer', 'landcoverChange-layer',
        'trees2016-layer', 'trees2024-layer', 'treeChange-layer',
      ];
      const features = map.queryRenderedFeatures(e.point, { layers });
      if (features.length > 0) {
        const f = features[0];
        let html = `<h3>${translateCategory(f.properties.CateTitle)}</h3>`;
        if (f.geometry?.type === 'Polygon')
          html += `<p>Área: ${turf.area(f.geometry).toFixed(2)} m²</p>`;
        if (f.properties.Change) {
          const ct = translateChange(f.properties.Change);
          html += `<p>Cambio: ${ct} (${ct === 'Añadido' ? 'Crecimiento' : 'Decrecimiento'})</p>`;
        }
        if (f.layer.id.includes('2016') || f.layer.id.includes('2024'))
          html += `<p>Año: ${f.layer.id.includes('2016') ? '2016' : '2024'}</p>`;

        new maplibregl.Popup().setLngLat(e.lngLat).setHTML(html).addTo(map);
      }
    });

    /* ─── Menú retráctil ─── */
    document.getElementById('menu-toggle')?.addEventListener('click', () => {
      document.getElementById('menu')?.classList.toggle('retracted');
    });
  }); // end map.on('load')
}

/* ─── Helpers ─── */

function translateCategory(c: string): string {
  const map: Record<string, string> = {
    impervious: 'Impermeable',
    bareland: 'Terreno descubierto',
    bare_ground: 'Terreno descubierto',
    shrub: 'Arbustos',
    forest: 'Árboles',
    grass: 'Pasto',
    water: 'Agua',
  };
  return map[c] || c;
}

function translateChange(c: string): string {
  const map: Record<string, string> = {
    added: 'Añadido',
    removed: 'Removido',
  };
  return map[c] || c;
}

