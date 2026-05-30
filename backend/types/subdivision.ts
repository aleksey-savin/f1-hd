import type { Types } from "mongoose";

export interface ISubdivision {
  name: string;
  email?: string;
  phone?: string;
  address?: string;
  linkToMap?: string;
  company: Types.ObjectId;
  manager?: Types.ObjectId;
  users?: Types.ObjectId[];
  parent?: Types.ObjectId;
  subdivisions?: Types.ObjectId[];
  createdAt: Date;
  updatedAt: Date;
}
