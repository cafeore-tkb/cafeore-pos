/** 秒数を、分（60で一周しない）と2桁の秒に分ける。92:07 なら { m: 92, ss: "07" } */
export const minSec = (seconds: number) => ({
  m: Math.floor(seconds / 60),
  ss: String(seconds % 60).padStart(2, "0"),
});
