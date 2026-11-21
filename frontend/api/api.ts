import axios from 'axios';
import type { AxiosError } from 'axios';
import type { Server, ServerDetail } from '@/types/types';

const API_URL = process.env.NEXT_PUBLIC_API_URL || '';

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

export const getUser = async () => {
  return await axios.get(`${API_URL}/users/@me`, { withCredentials: true }).then((res) => res.data);
};

export const getFriends = async () => {
  return await axios.get(`${API_URL}/friends`, { withCredentials: true }).then((res) => res.data);
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

export const getMessages = async (id: string, before?: string) => {
  return await axios.get(`${API_URL}/channels/${id}/messages`, { params: before ? { before } : undefined, withCredentials: true }).then((res) => res.data);
};

export const createMessage = async (channelId: string, content: string, nonce: string) => {
  return await axios.post(`${API_URL}/channels/${channelId}/messages`, { content, nonce }, { withCredentials: true }).then((res) => res.data);
};
