import type { LoggedExercise, Queries } from '../app/queries';
import { useBackupStatus } from '../backup';
import { today } from '../domain/date';
import { formatKg } from './format';
import { GraphIcon, SettingsIcon } from './icons';
import { href } from './nav';
import { SearchLink } from './SearchLink';

/** The last weight lifted, in that entry's colour. */
function Row({ exercise, lastWeightKg }: LoggedExercise) {
  return (
    <li className="row" data-colour={exercise.colour}>
      <a className="row-log" href={href({ name: 'log', exerciseId: exercise.id })}>
        <span className="row-name">{exercise.name}</span>
        <span className="row-weight">
          {lastWeightKg < 0 && <small>assistance</small>}
          {formatKg(lastWeightKg)}
        </span>
      </a>
      <a
        className="row-history"
        href={href({ name: 'exercise', exerciseId: exercise.id })}
        aria-label={`${exercise.name} history`}
      >
        <GraphIcon />
      </a>
    </li>
  );
}

function Empty() {
  const { connected } = useBackupStatus();
  return (
    <div className="empty">
      <p>Nothing logged yet.</p>
      <SearchLink className="save">Add an exercise</SearchLink>
      {!connected && (
        <a className="quiet" href={href({ name: 'settings' })}>
          Restore from backup
        </a>
      )}
    </div>
  );
}

export function HomeScreen({ queries }: { queries: Queries }) {
  const date = today();
  const groups = queries.logged();
  const workout = groups.length > 0 ? queries.nextWorkout(date) : null;
  return (
    <div className="screen">
      <header className="home-header">
        {workout && (
          <p className="next-workout">
            <small>Next workout</small>
            {workout}
          </p>
        )}
        <a href={href({ name: 'settings' })} aria-label="Settings">
          <SettingsIcon />
        </a>
      </header>
      {groups.length === 0 && <Empty />}
      {groups.map(({ group, exercises }) => (
        <section key={group}>
          <h2 className="group">{group}</h2>
          <ul className="rows">
            {exercises.map((row) => (
              <Row key={row.exercise.id} {...row} />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
