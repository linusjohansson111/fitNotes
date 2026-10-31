import { type Queries, useQueries } from './app/queries';
import { CustomScreen } from './ui/CustomScreen';
import { ExerciseScreen } from './ui/ExerciseScreen';
import { HomeScreen } from './ui/HomeScreen';
import { LogScreen } from './ui/LogScreen';
import { MapScreen } from './ui/MapScreen';
import { SearchScreen } from './ui/SearchScreen';
import { SettingsScreen } from './ui/SettingsScreen';
import { BodyIcon, HomeIcon, PlusIcon } from './ui/icons';
import { type Route, href, useRoute } from './ui/nav';
import { useToday } from './ui/useToday';

function Screen({ route, queries }: { route: Route; queries: Queries }) {
  switch (route.name) {
    case 'home':
      return <HomeScreen queries={queries} />;
    case 'search':
      return <SearchScreen queries={queries} />;
    case 'custom':
      return <CustomScreen initialName={route.initialName} />;
    case 'log':
      return <LogScreen queries={queries} exerciseId={route.exerciseId} entryId={route.entryId} />;
    case 'exercise':
      return <ExerciseScreen exerciseId={route.exerciseId} />;
    case 'map':
      return <MapScreen />;
    case 'settings':
      return <SettingsScreen queries={queries} />;
  }
}

function BottomBar({ route }: { route: Route }) {
  return (
    <nav className="bar">
      <a href={href({ name: 'home' })} aria-label="Home" aria-current={route.name === 'home' ? 'page' : undefined}>
        <HomeIcon />
      </a>
      <a
        className="bar-add"
        href={href({ name: 'search' })}
        aria-label="Add exercise"
        aria-current={route.name === 'search' ? 'page' : undefined}
      >
        <PlusIcon size={40} />
      </a>
      <a href={href({ name: 'map' })} aria-label="Map" aria-current={route.name === 'map' ? 'page' : undefined}>
        <BodyIcon />
      </a>
    </nav>
  );
}

export function App() {
  const route = useRoute();
  const day = useToday();
  const queries = useQueries();
  if (!queries) return null;

  return (
    <div className="app">
      {/* The key gives each route, and each new day, a fresh form and scroll position. */}
      <main key={`${href(route)} ${day}`} className="main">
        <Screen route={route} queries={queries} />
      </main>
      <BottomBar route={route} />
    </div>
  );
}
