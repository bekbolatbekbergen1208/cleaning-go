import { Platform, StyleSheet, View } from 'react-native';
import { createElement } from 'react';
import { WebView } from 'react-native-webview';

type Props = { latitude: number; longitude: number };

export const hasTwoGisKey = () => Boolean(process.env.EXPO_PUBLIC_2GIS_MAPGL_KEY);

function twoGisHtml(latitude: number, longitude: number, key: string) {
  const center = JSON.stringify([longitude, latitude]);
  const safeKey = JSON.stringify(key);
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no"><style>html,body,#map{width:100%;height:100%;margin:0;overflow:hidden}</style><script src="https://mapgl.2gis.com/api/js/v1"></script></head><body><div id="map"></div><script>const center=${center};const map=new mapgl.Map('map',{center,zoom:16,key:${safeKey},zoomControl:'bottomRight'});new mapgl.Marker(map,{coordinates:center,label:{text:'Клинер'}});</script></body></html>`;
}

// Keyless fallback: OpenStreetMap tiles through Leaflet. The tile layer sends
// the page origin as Referer, which OSM's tile usage policy requires.
function osmHtml(latitude: number, longitude: number) {
  const center = JSON.stringify([latitude, longitude]);
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no"><link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"><style>html,body,#map{width:100%;height:100%;margin:0;overflow:hidden}</style><script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script></head><body><div id="map"></div><script>const c=${center};const map=L.map('map',{zoomControl:true,attributionControl:true}).setView(c,16);L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,referrerPolicy:'strict-origin-when-cross-origin',attribution:'&copy; OpenStreetMap'}).addTo(map);L.circleMarker(c,{radius:10,color:'#fff',weight:3,fillColor:'#059669',fillOpacity:1}).bindTooltip('Клинер',{permanent:true,direction:'top',offset:[0,-10]}).addTo(map);</script></body></html>`;
}

export function TwoGisMap({ latitude, longitude }: Props) {
  const key = process.env.EXPO_PUBLIC_2GIS_MAPGL_KEY ?? '';
  // Previously a missing 2GIS key rendered nothing, leaving an empty map card.
  const html = key ? twoGisHtml(latitude, longitude, key) : osmHtml(latitude, longitude);
  const title = key ? 'Клинер на карте 2GIS' : 'Клинер на карте';
  if (Platform.OS === 'web') {
    return <View style={styles.map}>{createElement('iframe', { srcDoc: html, title, style: { width: '100%', height: '100%', border: 0 } })}</View>;
  }
  return (
    <WebView
      style={styles.map}
      originWhitelist={['*']}
      // A real origin gives the page a Referer for the map tile servers.
      source={{ html, baseUrl: 'https://cleaninggo.app/' }}
      javaScriptEnabled
      scrollEnabled={false}
    />
  );
}

const styles = StyleSheet.create({ map: { width: '100%', height: 300, borderRadius: 16, overflow: 'hidden' } });
