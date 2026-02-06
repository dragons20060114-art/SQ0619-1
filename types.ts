
export interface OrderItem {
  id: string;
  name: string;
  price: string;
  note: string;
  quantity: number;
  hasAddon: boolean;
  addonName: string;
  addonPrice: string;
}

export interface UserInfo {
  empId: string;
  empName: string;
  phone: string;
  orderNote: string;
}

export interface OrderHistoryEntry extends UserInfo {
  items: OrderItem[];
  total: number;
  timestamp: string;
}

export enum Step {
  Selection = 1,
  UserInfo = 2,
  Review = 3,
  Success = 4,
  History = 5
}
