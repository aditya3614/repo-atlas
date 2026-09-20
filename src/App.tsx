import { Landing } from './screens/Landing';
import { Toasts } from './components/Toasts';
import { useUi } from './store/ui';

export default function App() {
  const screen = useUi((s) => s.screen);

  return (
    <>
      {screen === 'landing' && <Landing />}
      <Toasts />
    </>
  );
}
