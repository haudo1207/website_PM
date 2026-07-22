'use client';
import { Suspense } from 'react';
import ProjectListContent from '@/components/ProjectListContent';

export default function ProjectPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-[#f8fafc]" />}>
      <ProjectListContent />
    </Suspense>
  );
}
