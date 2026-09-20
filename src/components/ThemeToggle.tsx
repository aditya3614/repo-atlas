import { useUi } from '../store/ui';

export function ThemeToggle() {
  const theme = useUi((s) => s.theme);
  const toggleTheme = useUi((s) => s.toggleTheme);
  const next = theme === 'night' ? 'Paper' : 'Night';

  return (
    <button
      type="button"
      className="btn btn-ghost theme-toggle"
      onClick={toggleTheme}
      aria-label={`Switch to ${next} theme`}
      title={`Switch to ${next} theme`}
    >
      <span className="theme-dot" aria-hidden="true" />
      {next}
    </button>
  );
}
