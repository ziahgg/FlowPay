import { UserRole } from '../entities/user-role.enum';

export class UserProfileDto {
  id!: string;
  email!: string;
  role!: UserRole;
  createdAt!: Date;
  updatedAt!: Date;
}
