export type UserRole = 'user' | 'admin';
export type UserStatus = 'active' | 'disabled';

export type User = {
  id: string;
  username: string;
  email: string | null;
  displayName: string | null;
  avatarUrl: string | null;
  bio: string | null;
  role: UserRole;
  status: UserStatus;
  createdAt: Date;
  updatedAt: Date;
};

export type CreateUserInput = {
  username: string;
  email?: string | null;
  displayName?: string | null;
};

export type PublicUserProfile = Pick<User, 'id' | 'username' | 'displayName' | 'avatarUrl' | 'bio' | 'createdAt'> & {
  online: boolean;
};

export type UpdateProfileInput = {
  displayName?: string | null;
  avatarUrl?: string | null;
  bio?: string | null;
};

export type Friendship = {
  id: string;
  requesterId: string;
  addresseeId: string;
  status: 'pending' | 'accepted';
  createdAt: Date;
  updatedAt: Date;
};
