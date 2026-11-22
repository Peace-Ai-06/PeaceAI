export const sent = [];
export let failNext = false;

export function resetMailCapture() {
  sent.length = 0;
  failNext = false;
}

export function setMailFailure(value) {
  failNext = Boolean(value);
}

export async function captureMail(message) {
  if (failNext) throw new Error('smtp down');
  sent.push(message);
}
