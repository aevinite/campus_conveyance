import { redirect } from 'next/navigation';

// The flat routes list has been replaced by the campus → agency → routes flow.
export default function RoutesIndex() {
  redirect('/student/schools');
}
