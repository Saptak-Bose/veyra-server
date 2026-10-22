export type MeetingParticipantUser = {
  socketId: string;
  userId: string;
  userName: string;
  isHost: boolean;
  audioEnabled: boolean;
  videoEnabled: boolean;
};

export type MeetingUser = {
  id: string;
  name: string | null;
};

export type ChatMessage = {
  id: string;
  senderId: string;
  senderName: string;
  text: string;
  time: string;
};
