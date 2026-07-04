import { UserProfileDto } from '../../users/dto/user-profile.dto';

export class AuthResponseDto {
  accessToken!: string;
  user!: UserProfileDto;
}
