export type UserRole =
  | 'client'
  | 'cleaner'
  | 'company_owner'
  | 'company_cleaner'
  | 'admin';

export type VerificationStatus = 'pending' | 'approved' | 'rejected' | 'blocked';

export type OrderStatus =
  | 'created'
  | 'searching'
  | 'offered'
  | 'accepted'
  | 'on_the_way'
  | 'arrived'
  | 'in_progress'
  | 'completed_by_cleaner'
  | 'completed'
  | 'cancelled'
  | 'disputed';

export type PaymentMethod = 'cash' | 'card' | 'test';
export type PaymentStatus = 'pending' | 'paid' | 'failed' | 'refunded';
export type ExecutorPreference = 'cleaner' | 'company' | 'any';

export interface Profile {
  id: string;
  role: UserRole;
  full_name: string;
  phone: string | null;
  email: string | null;
  avatar_url: string | null;
  city: string | null;
  referral_code: string;
}

export interface CleaningService {
  id: string;
  name: string;
  description: string | null;
  base_price_minor: number;
  unit: string;
  duration_minutes: number;
  image_url: string | null;
  is_active: boolean;
}

export interface Order {
  id: string;
  order_number: string;
  client_id: string;
  service_id: string;
  city: string;
  address_text: string;
  scheduled_at: string;
  area_sq_m: number;
  rooms_count: number;
  status: OrderStatus;
  total_minor: number;
  platform_fee_minor: number;
  referral_reward_minor: number;
  executor_amount_minor: number;
  payment_method: PaymentMethod;
  payment_status: PaymentStatus;
}

export interface OrderDraft {
  serviceId: string;
  addressId: string;
  scheduledAt: string;
  areaSqM: number;
  roomsCount: number;
  comment?: string;
  executorPreference: ExecutorPreference;
  selectedCleanerId?: string;
  selectedCompanyId?: string;
  paymentMethod: PaymentMethod;
  optionIds: string[];
}

export interface MoneyBreakdown {
  totalMinor: number;
  platformFeeMinor: number;
  referralRewardMinor: number;
  executorAmountMinor: number;
}
