'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import type { ActionResult } from '@/server/actions/result';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';

/**
 * A destructive action behind a confirmation dialog.
 *
 * Radix AlertDialog rather than `window.confirm`: it traps focus, returns it
 * to the trigger, is styled with the theme, and its buttons are labelled with
 * the actual action rather than OK / Cancel. Errors go to a toast because
 * these live inside table rows where there is nowhere to render a message.
 */
export function ConfirmForm({
  action,
  values,
  label,
  confirmMessage,
  confirmLabel,
}: {
  action: (formData: FormData) => Promise<ActionResult>;
  values: Record<string, string>;
  label: string;
  confirmMessage: string;
  /** Button text inside the dialog; defaults to the trigger label. */
  confirmLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function run() {
    const formData = new FormData();
    for (const [key, value] of Object.entries(values)) formData.set(key, value);
    startTransition(async () => {
      const result = await action(formData);
      if (!result.ok) {
        toast.error(result.error);
      } else {
        setOpen(false);
      }
      router.refresh();
    });
  }

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger asChild>
        <Button variant="link" size="xs" className="text-destructive" disabled={pending}>
          {pending ? 'Working…' : label}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{label}</AlertDialogTitle>
          <AlertDialogDescription>{confirmMessage}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={(event) => {
              // Keep the dialog open until the action resolves, so a failure
              // can be shown without the row having already vanished.
              event.preventDefault();
              run();
            }}
            disabled={pending}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {pending ? 'Working…' : (confirmLabel ?? label)}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
