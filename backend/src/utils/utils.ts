const EPOCH = new Date(2021, 2, 23).valueOf();

var SEQUENCE = 1;

export const generateId = (): string => {
  const timestamp = new Date(Date.now()).valueOf();
  let result = (BigInt(timestamp) - BigInt(EPOCH)) << BigInt(22);
  result = result | BigInt(SEQUENCE++ % 4096);
  return result.toString();
};
