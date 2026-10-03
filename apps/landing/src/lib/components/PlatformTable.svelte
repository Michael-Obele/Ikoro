<script lang="ts">
	import { Badge, type BadgeVariant } from '@ikoro/ui';
	import { platforms, type Platform } from '$lib/content';

	/**
	 * The honest platform table.
	 *
	 * A real `<table>` rather than a grid of cards: the rows are comparable, the
	 * columns are categories, and a screen reader can say "Status, unsupported"
	 * for a cell instead of reading three unlabelled boxes in order.
	 *
	 * Status is a word, never a colour. `Badge` ships the colour; the word is what
	 * carries the meaning, and the two are never allowed to disagree.
	 */
	const STATUS: Record<Platform['status'], { text: string; variant: BadgeVariant }> = {
		released: { text: 'Available', variant: 'default' },
		unreleased: { text: 'Not released yet', variant: 'secondary' },
		building: { text: 'Not built yet', variant: 'secondary' },
		preview: { text: 'Preview', variant: 'outline' },
		unsupported: { text: 'Not supported', variant: 'destructive' }
	};
</script>

<div class="overflow-x-auto">
	<table class="w-full min-w-3xl border-collapse text-left text-sm">
		<caption class="sr-only">
			Where Ikoro runs, and what each platform does with a reminder.
		</caption>
		<thead>
			<tr class="border-b">
				<th scope="col" class="py-3 pr-4 font-medium">Platform</th>
				<th scope="col" class="py-3 pr-4 font-medium">Status</th>
				<th scope="col" class="py-3 pr-4 font-medium">What happens</th>
				<th scope="col" class="py-3 font-medium"><span class="sr-only">Get it</span></th>
			</tr>
		</thead>
		<tbody>
			{#each platforms as platform (platform.id)}
				<tr class="border-b align-top last:border-0">
					<th scope="row" class="py-4 pr-4 font-medium">{platform.name}</th>
					<td class="py-4 pr-4">
						<Badge variant={STATUS[platform.status].variant}>
							{STATUS[platform.status].text}
						</Badge>
					</td>
					<td class="max-w-xl py-4 pr-4 text-muted-foreground">{platform.detail}</td>
					<td class="py-4 whitespace-nowrap">
						{#if platform.href && platform.action}
							<a class="underline underline-offset-4" href={platform.href}>
								{platform.action}
							</a>
						{/if}
					</td>
				</tr>
			{/each}
		</tbody>
	</table>
</div>
