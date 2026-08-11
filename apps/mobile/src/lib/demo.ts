import type { CleaningService } from '@cleaning-go/types';

export const demoServices: CleaningService[] = [
  { id:'10000000-0000-0000-0000-000000000001',name:'Стандартная уборка',description:'Регулярная уборка квартиры',base_price_minor:800000,unit:'за выезд',duration_minutes:120,image_url:null,is_active:true },
  { id:'10000000-0000-0000-0000-000000000002',name:'Генеральная уборка',description:'Тщательная уборка всех зон',base_price_minor:1800000,unit:'за выезд',duration_minutes:300,image_url:null,is_active:true },
  { id:'10000000-0000-0000-0000-000000000003',name:'После ремонта',description:'Удаление строительной пыли',base_price_minor:2500000,unit:'за выезд',duration_minutes:420,image_url:null,is_active:true },
  { id:'10000000-0000-0000-0000-000000000004',name:'Уборка офиса',description:'Для коммерческих помещений',base_price_minor:1500000,unit:'за выезд',duration_minutes:240,image_url:null,is_active:true },
  { id:'10000000-0000-0000-0000-000000000005',name:'Мойка окон',description:'Окна и рамы',base_price_minor:500000,unit:'за окно',duration_minutes:90,image_url:null,is_active:true },
  { id:'10000000-0000-0000-0000-000000000006',name:'Химчистка мебели',description:'Диваны и кресла',base_price_minor:1200000,unit:'за предмет',duration_minutes:150,image_url:null,is_active:true },
  { id:'10000000-0000-0000-0000-000000000007',name:'Дополнительная услуга',description:'Индивидуальная задача',base_price_minor:300000,unit:'за услугу',duration_minutes:60,image_url:null,is_active:true },
];
