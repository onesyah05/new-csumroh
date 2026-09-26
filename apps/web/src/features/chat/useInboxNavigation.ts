import { useState, type SetStateAction } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useMobile } from '../../lib/useMobile';
import type { ChatSidePanelTab } from './ChatSidePanel';

/** Mobile screens are URL-backed, so system Back and onscreen Back agree. */
export function useInboxNavigation() {
  const mobile = useMobile();
  const [params, setParams] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();
  const [desktopPanel, setDesktopPanel] = useState<ChatSidePanelTab | null>(() => window.matchMedia?.('(max-width: 1279px)').matches ? null : 'profile');
  const mobileView = ['prospectId', 'phone', 'jid'].some(key => params.has(key)) ? 'chat' : 'list';
  const panel = params.get('panel');
  const sidePanelTab = mobile ? (mobileView === 'chat' && (panel === 'profile' || panel === 'copilot') ? panel : null) : desktopPanel;
  function setSidePanelTab(action: SetStateAction<ChatSidePanelTab | null>) {
    const next = typeof action === 'function' ? action(sidePanelTab) : action;
    if (!mobile) { setDesktopPanel(next); return; }
    if (next === sidePanelTab) return;
    if (!next && location.state?.inboxPanel) { navigate(-1); return; }
    setParams(previous => {
      const updated = new URLSearchParams(previous);
      if (next) updated.set('panel', next); else updated.delete('panel');
      return updated;
    }, { replace: Boolean(sidePanelTab), state: { ...location.state, inboxPanel: next ? true : undefined } });
  }
  function backToList() {
    if (location.state?.inboxList) { navigate(-1); return; }
    setParams(previous => {
      const updated = new URLSearchParams(previous);
      ['prospectId', 'phone', 'jid', 'panel'].forEach(key => updated.delete(key));
      return updated;
    }, { replace: true, state: null });
  }
  return { mobile, mobileView, sidePanelTab, setSidePanelTab, backToList };
}
