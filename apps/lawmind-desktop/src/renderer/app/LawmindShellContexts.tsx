import { createContext, useContext, type ReactNode } from "react";

export type ShellNavigationContextValue = {
  mainView: "workspace" | "collaboration" | "review";
  matterCockpitOpen: boolean;
  settingsOpen: boolean;
};

export type ChatSessionContextValue = {
  selectedAssistantId: string;
  activeChatSessionId: string | undefined;
};

const ShellNavigationContext = createContext<ShellNavigationContextValue | null>(null);
const ChatSessionContext = createContext<ChatSessionContextValue | null>(null);

export function LawmindShellProviders(props: {
  navigation: ShellNavigationContextValue;
  chatSession: ChatSessionContextValue;
  children: ReactNode;
}) {
  const { navigation, chatSession, children } = props;
  return (
    <ShellNavigationContext.Provider value={navigation}>
      <ChatSessionContext.Provider value={chatSession}>{children}</ChatSessionContext.Provider>
    </ShellNavigationContext.Provider>
  );
}

export function useLawmindShellNavigationContext(): ShellNavigationContextValue {
  return (
    useContext(ShellNavigationContext) ?? {
      mainView: "workspace",
      matterCockpitOpen: false,
      settingsOpen: false,
    }
  );
}

export function useLawmindChatSessionContext(): ChatSessionContextValue {
  return (
    useContext(ChatSessionContext) ?? {
      selectedAssistantId: "",
      activeChatSessionId: undefined,
    }
  );
}
