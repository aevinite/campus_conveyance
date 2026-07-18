import { addCollegeAction } from '@/features/admin/actions';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { CollegeForm } from '../college-form';

export default function AddCollegePage() {
  return (
    <section className="space-y-4">
      <h1 className="text-2xl font-semibold">Add New College</h1>
      <Card>
        <CardHeader>
          <CardTitle>College details</CardTitle>
        </CardHeader>
        <CardContent>
          <CollegeForm action={addCollegeAction} submitLabel="Add College" />
        </CardContent>
      </Card>
    </section>
  );
}
