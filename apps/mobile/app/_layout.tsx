import { Stack, useRouter, useSegments } from 'expo-router';
import { useEffect } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { supabase } from '@/lib/supabase';
import { useSessionStore } from '@/store/session';

const demoMode=process.env.EXPO_PUBLIC_DEMO_MODE==='true';
export default function RootLayout(){const router=useRouter();const segments=useSegments();const {session,loading,setSession,setProfile,setLoading}=useSessionStore();
useEffect(()=>{if(demoMode){setLoading(false);return;}void supabase.auth.getSession().then(({data})=>setSession(data.session));const {data}=supabase.auth.onAuthStateChange((_e,s)=>setSession(s));return()=>data.subscription.unsubscribe();},[]);
useEffect(()=>{if(demoMode)return;void(async()=>{if(session){const {data}=await supabase.from('profiles').select('*').eq('id',session.user.id).single();setProfile(data);}else setProfile(null);setLoading(false);})();},[session]);
useEffect(()=>{if(loading||demoMode)return;const inAuth=segments[0]==='(auth)';if(!session&&!inAuth)router.replace('/(auth)/welcome');if(session&&inAuth)router.replace('/(tabs)');},[session,loading,segments]);
if(loading)return <View style={{flex:1,alignItems:'center',justifyContent:'center'}}><ActivityIndicator/></View>;
return <Stack screenOptions={{headerShown:false}}><Stack.Screen name="(auth)"/><Stack.Screen name="(tabs)"/><Stack.Screen name="order/[id]" options={{headerShown:true,title:'Заказ'}}/><Stack.Screen name="create-order" options={{headerShown:true,title:'Новый заказ'}}/><Stack.Screen name="select-company" options={{headerShown:true,title:'Выбор компании'}}/></Stack>}
