import axios from 'axios';
import type { AxiosError } from 'axios';

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
