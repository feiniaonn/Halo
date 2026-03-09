export type EpgProgramme = {
  title: string;
  start: string;
  end: string;
  desc?: string;
};

export async function fetchChannelEpg(  _channelId: string): Promise<EpgProgramme[]> { // eslint-disable-line @typescript-eslint/no-unused-vars
  return [];
}
