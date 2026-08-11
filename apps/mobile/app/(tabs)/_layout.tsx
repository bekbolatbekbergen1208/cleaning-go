import { colors } from '@cleaning-go/ui'; import { Tabs } from 'expo-router'; import { Text, useWindowDimensions } from 'react-native'; import { useSessionStore } from '@/store/session';
const icon=(symbol:string,color:string)=><Text style={{color,fontSize:18}}>{symbol}</Text>;
export default function TabsLayout(){const role=useSessionStore(s=>s.profile?.role);const {width}=useWindowDimensions();const compact=width<390;const cleaner=role==='cleaner'||role==='company_cleaner';const company=role==='company_owner';return <Tabs screenOptions={{headerShown:false,tabBarActiveTintColor:colors.primary,tabBarInactiveTintColor:'#7B8B87',tabBarHideOnKeyboard:true,tabBarLabelStyle:{fontSize:compact?9:11,fontWeight:'700'},tabBarIconStyle:{marginTop:4},tabBarItemStyle:{minWidth:0,paddingHorizontal:1},tabBarStyle:{height:compact?62:68,paddingTop:3,paddingBottom:compact?5:8,borderTopColor:'#DCE9E5',backgroundColor:'#FFFFFF'}}}>
<Tabs.Screen name="index" options={{title:company?'Компания':cleaner?'Активность':'Главная',tabBarIcon:({color})=>icon('⌂',color)}}/>
<Tabs.Screen name="orders" options={{title:'Заказы',tabBarIcon:({color})=>icon('▤',color)}}/>
<Tabs.Screen name="reports" options={{title:'Отчёты',href:company?'/reports':null,tabBarIcon:({color})=>icon('▦',color)}}/>
<Tabs.Screen name="referrals" options={{title:'Рефералы',href:company?null:'/referrals',tabBarIcon:({color})=>icon('%',color)}}/>
<Tabs.Screen name="notifications" options={{title:company?'Сотрудники':'Уведомления',tabBarIcon:({color})=>icon('●',color)}}/>
<Tabs.Screen name="profile" options={{title:'Профиль',tabBarIcon:({color})=>icon('○',color)}}/>
</Tabs>}
