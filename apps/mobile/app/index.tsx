import { Redirect } from 'expo-router';
export default function Index(){return <Redirect href={process.env.EXPO_PUBLIC_DEMO_MODE==='true'?"/(auth)/welcome":"/(tabs)"}/>}
