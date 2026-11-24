import axios from 'axios';
import type { AxiosError } from 'axios';
import { logoutToLogin } from '@/lib/logout';
import type { AccountSession, CurrentUser, IncomingFriendRequest, OutgoingFriendRequest, ProfileDTO, Server, ServerChannel, ServerDetail, ServerInvite } from '@/types/types';

const API_URL = process.env.NEXT_PUBLIC_API_URL || '';

// Drop cached private data and send to the login on expired/revoked session
axios.interceptors.response.use(undefined, (error: AxiosError) => {
  if (error.response?.status === 401) {
    logoutToLogin('expired');
  }

  return Promise.reject(error);
});

export const signup = async (username: string, password: string) => {
  try {
    const response = await axios.post(`${API_URL}/signup`, { username, password }, { withCredentials: true });
    return {
      success: true,
      data: response.data,
    };
  } catch (e) {
    const error = e as AxiosError;
    return {
      success: false,
      msg: error.response?.data || 'An unknown error occurred',
    };
  }
};

export const login = async (username: string, password: string) => {
  try {
    const response = await axios.post(`${API_URL}/login`, { username, password }, { withCredentials: true });
    return {
      success: true,
      data: response.data,
    };
  } catch (e) {
    const error = e as AxiosError;
    return {
      success: false,
      msg: error.response?.data || 'An unknown error occurred',
    };
  }
};

export const logout = async () => {
  try {
    const response = await axios.post(`${API_URL}/logout`, {}, { withCredentials: true });
    return {
      success: true,
      data: response.data,
    };
  } catch (e) {
    const error = e as AxiosError;
    return {
      success: false,
      msg: error.response?.data || 'An unknown error occurred',
    };
  }
};

export const changePassword = async (currentPassword: string, newPassword: string) => {
  await axios.post(`${API_URL}/account/password`, { currentPassword, newPassword }, { withCredentials: true });
};

export const getSessions = async (): Promise<AccountSession[]> => {
  return await axios.get(`${API_URL}/account/sessions`, { withCredentials: true }).then((res) => res.data);
};

export const revokeSession = async (id: string) => {
  await axios.delete(`${API_URL}/account/sessions/${encodeURIComponent(id)}`, { withCredentials: true });
};

export const revokeAllSessions = async () => {
  await axios.delete(`${API_URL}/account/sessions`, { withCredentials: true });
};

export const getUser = async (): Promise<CurrentUser> => {
  return await axios.get(`${API_URL}/users/@me`, { withCredentials: true }).then((res) => res.data);
};

export const getUserProfile = async (id: string): Promise<ProfileDTO> => {
  return await axios.get(`${API_URL}/users/${encodeURIComponent(id)}`, { withCredentials: true }).then((res) => res.data);
};

export const getFriends = async () => {
  return await axios.get(`${API_URL}/friends`, { withCredentials: true }).then((res) => res.data);
};

export const getPendingRequests = async (): Promise<IncomingFriendRequest[]> => {
  return await axios.get(`${API_URL}/friends/pendingRequests`, { withCredentials: true }).then((res) => res.data);
};

export const getSentRequests = async (): Promise<OutgoingFriendRequest[]> => {
  return await axios.get(`${API_URL}/friends/sentRequests`, { withCredentials: true }).then((res) => res.data);
};

export const getServers = async (): Promise<Server[]> => {
  return await axios.get(`${API_URL}/servers`, { withCredentials: true }).then((res) => res.data);
};

export const getServer = async (id: string): Promise<ServerDetail> => {
  return await axios.get(`${API_URL}/servers/${id}`, { withCredentials: true }).then((res) => res.data);
};

export const createServer = async (name: string): Promise<Server> => {
  return await axios.post(`${API_URL}/servers/create`, { name }, { withCredentials: true }).then((res) => res.data);
};

export const joinServer = async (code: string): Promise<Server> => {
  return await axios.post(`${API_URL}/servers/join`, { code }, { withCredentials: true }).then((res) => res.data);
};

export const createChannel = async (serverId: string, name: string): Promise<ServerChannel> => {
  return await axios.post(`${API_URL}/servers/${serverId}/channels`, { name }, { withCredentials: true }).then((res) => res.data);
};

export const renameServer = async (serverId: string, name: string): Promise<{ id: string; name: string }> => {
  return await axios.patch(`${API_URL}/servers/${serverId}`, { name }, { withCredentials: true }).then((res) => res.data);
};

export const createInvite = async (serverId: string): Promise<{ code: string }> => {
  return await axios.post(`${API_URL}/servers/${serverId}/invites`, {}, { withCredentials: true }).then((res) => res.data);
};

export const getInvites = async (serverId: string): Promise<ServerInvite[]> => {
  return await axios.get(`${API_URL}/servers/${serverId}/invites`, { withCredentials: true }).then((res) => res.data);
};

export const revokeInvite = async (serverId: string, code: string) => {
  await axios.delete(`${API_URL}/servers/${serverId}/invites/${code}`, { withCredentials: true });
};

export const removeMember = async (serverId: string, userId: string) => {
  await axios.delete(`${API_URL}/servers/${serverId}/members/${userId}`, { withCredentials: true });
};

export const leaveServer = async (serverId: string) => {
  await axios.post(`${API_URL}/servers/${serverId}/leave`, {}, { withCredentials: true });
};

export const getMessages = async (id: string, before?: string) => {
  return await axios.get(`${API_URL}/channels/${id}/messages`, { params: before ? { before } : undefined, withCredentials: true }).then((res) => res.data);
};

export const createMessage = async (channelId: string, content: string, nonce: string) => {
  return await axios.post(`${API_URL}/channels/${channelId}/messages`, { content, nonce }, { withCredentials: true }).then((res) => res.data);
};
