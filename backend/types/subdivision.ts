import type { Types } from "mongoose";

export interface ISubdivision {
  name: string;
  email?: string;
  phone?: string;
  address?: string;
  linkToMap?: string;
  /** IANA-зона филиала; null — наследуется от родителя/компании/организации. */
  timezone?: string | null;
  company: Types.ObjectId;
  manager?: Types.ObjectId;
  users?: Types.ObjectId[];
  parent?: Types.ObjectId;
  subdivisions?: Types.ObjectId[];
  createdAt: Date;
  updatedAt: Date;
}
