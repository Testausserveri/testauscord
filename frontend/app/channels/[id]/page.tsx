'use client';

import { notFound, useParams } from 'next/navigation';

export default function Channels() {
  const params = useParams();
  console.log(params.id);

  notFound();
}
