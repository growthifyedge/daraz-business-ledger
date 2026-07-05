import { PageSkeleton } from '@/components/Skeleton';

// Shown while any dashboard route's server component is loading.
export default function Loading() {
  return <PageSkeleton />;
}
