import { AnimatePresence } from 'framer-motion';
import { Landing } from './screens/Landing';
import { Loading } from './screens/Loading';
import { Main } from './screens/Main';
import { Toasts } from './components/Toasts';
import { useAtlas } from './store/atlas';

export default function App() {
  const status = useAtlas((s) => s.status);
  const reset = useAtlas((s) => s.reset);

  return (
    <>
      {status === 'ready' ? <Main /> : <Landing />}
      <AnimatePresence>{status === 'loading' && <Loading onCancel={reset} />}</AnimatePresence>
      <Toasts />
    </>
  );
}
