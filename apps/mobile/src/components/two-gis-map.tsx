import { Platform, StyleSheet, View } from 'react-native';
import { createElement } from 'react';
import { WebView } from 'react-native-webview';

type Props = { latitude: number; longitude: number };

function mapHtml(latitude: number, longitude: number, key: string) {
  const center = JSON.stringify([longitude, latitude]);
  const safeKey = JSON.stringify(key);
  return `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no"><style>html,body,#map{width:100%;height:100%;margin:0;overflow:hidden}</style><script src="https://mapgl.2gis.com/api/js/v1"></script></head><body><div id="map"></div><script>const center=${center};const map=new mapgl.Map('map',{center,zoom:16,key:${safeKey},zoomControl:'bottomRight'});new mapgl.Marker(map,{coordinates:center,label:{text:'Клинер'}});</script></body></html>`;
}

export function TwoGisMap({ latitude, longitude }: Props) {
  const key = process.env.EXPO_PUBLIC_2GIS_MAPGL_KEY ?? '';
  if (!key) return null;
  const html = mapHtml(latitude, longitude, key);
  if (Platform.OS === 'web') {
    return <View style={styles.map}>{createElement('iframe', { srcDoc: html, title: 'Клинер на карте 2GIS', style: { width: '100%', height: '100%', border: 0 } })}</View>;
  }
  return <WebView style={styles.map} originWhitelist={['*']} source={{ html }} javaScriptEnabled scrollEnabled={false} />;
}

const styles = StyleSheet.create({ map: { width: '100%', height: 300, borderRadius: 16, overflow: 'hidden' } });
