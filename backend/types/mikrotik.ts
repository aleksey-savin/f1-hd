export interface IMikrotikAddress {
  address?: string;
  network?: string;
  interface?: string;
  invalid?: string;
  dynamic?: string;
  disabled?: string;
  comment?: string;
}

export interface IMikrotik {
  credentials?: {
    host?: string;
    port?: number;
    user?: string;
    password?: string;
  };
  name?: string;
  boardName?: string;
  serialNumber?: string;
  currentFirmware?: string;
  addresses?: IMikrotikAddress[];
  description?: string;
  createdAt: Date;
  updatedAt: Date;
}
