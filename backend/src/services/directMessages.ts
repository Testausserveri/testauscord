export const friendPair = (a: string, b: string) => (a < b ? { userAId: a, userBId: b } : { userAId: b, userBId: a });

export const directChannelKey = (a: string, b: string): string => {
  const { userAId, userBId } = friendPair(a, b);
  return `${userAId}:${userBId}`;
};
