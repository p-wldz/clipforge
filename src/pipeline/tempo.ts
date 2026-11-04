/** Pitch-preserving audio tempo for 0.25× to 4×. */
export function audioTempoFilter(speed:number):string {
  if(!Number.isFinite(speed)||speed<0.25||speed>4)throw new Error('Speed must be between 0.25 and 4');
  const factors:number[]=[];
  while(speed<0.5){factors.push(0.5);speed/=0.5;}
  while(speed>2){factors.push(2);speed/=2;}
  factors.push(speed);
  return factors.map(v=>`atempo=${v}`).join(',');
}
