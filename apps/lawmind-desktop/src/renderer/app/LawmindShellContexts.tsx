import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import type { LawmindMainView } from "../lawmind-main-view";

export type ShellNavigationContextValue = {
  mainView: LawmindMainView;
  matterCockpitOpen: boolean;
  settingsOpen: boolean;
};

export type ChatSessionContextValue = {
  selectedAssistantId: string;
  activeChatSessionId: string | undefined;
};

export type AutomationsNavContextValue = {
  selectedAutomationId: string | null;
  setSelectedAutomationId: (id: string | null) => void;
};

const ShellNavigationContext = createContext<ShellNavigationContextValue | null>(null);
const ChatSessionContext = createContext<ChatSessionContextValue | null>(null);
const AutomationsNavContext = createContext<AutomationsNavContextValue | null>(null);

function AutomationsNavProvider(props: { children: ReactNode }) {
  const { children } = props;
  const [selectedAutomationId, setSelectedAutomationId] = useState<string | null>(null);

  const value = useMemo(
    (): AutomationsNavContextValue => ({
      selectedAutomationId,
      setSelectedAutomationId,
    }),
    [selectedAutomationId],
  );

  return <AutomationsNavContext.Provider value={value}>{children}</AutomationsNavContext.Provider>;
}

export function LawmindShellProviders(props: {
  navigation: ShellNavigationContextValue;
  chatSession: ChatSessionContextValue;
  children: ReactNode;
}) {
  const { navigation, chatSession, children } = props;
  return (
    <ShellNavigationContext.Provider value={navigation}>
      <ChatSessionContext.Provider value={chatSession}>
        <AutomationsNavProvider>{children}</AutomationsNavProvider>
      </ChatSessionContext.Provider>
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

export function useLawmindAutomationsNavContext(): AutomationsNavContextValue {
  return (
    useContext(AutomationsNavContext) ?? {
      selectedAutomationId: null,
      setSelectedAutomationId: () => {},
    }
  );
}
