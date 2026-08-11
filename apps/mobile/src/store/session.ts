import type { Profile } from '@cleaning-go/types';
import type { Order, OrderStatus } from '@cleaning-go/types';
import type { Session } from '@supabase/supabase-js';
import { create } from 'zustand';

interface SessionState { session: Session | null; profile: Profile | null; loading: boolean; demoOrders: Order[]; setSession: (session: Session | null) => void; setProfile: (profile: Profile | null) => void; setLoading: (value: boolean) => void; addDemoOrder:(order:Order)=>void;updateDemoOrderStatus:(id:string,status:OrderStatus)=>void; }
export const useSessionStore = create<SessionState>((set) => ({ session: null, profile: null, loading: true, demoOrders:[], setSession: (session) => set({ session }), setProfile: (profile) => set({ profile }), setLoading: (loading) => set({ loading }),addDemoOrder:(order)=>set(state=>({demoOrders:[order,...state.demoOrders]})),updateDemoOrderStatus:(id,status)=>set(state=>({demoOrders:state.demoOrders.map(order=>order.id===id?{...order,status}:order)})) }));
