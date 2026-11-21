import axios from 'axios';

export const apiErrorMessage = (error: unknown) => {
  if (axios.isAxiosError(error) && typeof error.response?.data === 'string') return error.response.data;
  return 'Something went wrong';
};
