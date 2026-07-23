import { PlusCircle } from 'lucide-react';
import { addCollegeAction } from '@/features/admin/actions';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { CollegeForm } from '../college-form';

export default function AddCollegePage() {
  return (
    <section className="space-y-4">
      <div>
        <span className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-widest text-primary">
          <PlusCircle className="size-3.5" />
          New institution
        </span>
        <h1 className="mt-1 text-2xl font-bold tracking-tight sm:text-3xl">Add New College</h1>
        <p className="text-muted-foreground">Onboard a school or college so providers and students can find it.</p>
      </div>
      <Card className="rounded-2xl">
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
