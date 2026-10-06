<script lang="ts" generics="T">
    import type { Snippet } from 'svelte';

    /**
     * Text input with a suggestion list, following the WAI-ARIA combobox
     * pattern: focus stays in the input, arrow keys move the active option
     * (announced via aria-activedescendant), Enter picks it, Escape closes.
     */
    interface Props {
        id: string;
        label: string;
        /** Hide the label visually (it is still read by screen readers). */
        labelHidden?: boolean;
        value?: string;
        items: T[];
        placeholder?: string;
        /** Announced politely, e.g. "3 results". Kept mounted so changes are read. */
        status?: string;
        option: Snippet<[T]>;
        onInput?: (value: string) => void;
        onSelect: (item: T) => void;
    }

    let {
        id,
        label,
        labelHidden = false,
        value = $bindable(''),
        items,
        placeholder = '',
        status = '',
        option,
        onInput,
        onSelect
    }: Props = $props();

    let open = $state(false);
    let activeIndex = $state(-1);
    const listboxId = $derived(`${id}-listbox`);
    const optionId = (i: number) => `${id}-option-${i}`;

    // New suggestions open the list with the first one active.
    $effect(() => {
        open = items.length > 0;
        activeIndex = items.length > 0 ? 0 : -1;
    });

    function choose(item: T) {
        open = false;
        onSelect(item);
    }

    function onKeyDown(e: KeyboardEvent) {
        if (e.key === 'Escape') {
            if (open) e.preventDefault();
            open = false;
            return;
        }
        if (items.length === 0) return;
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            if (!open) open = true;
            else activeIndex = (activeIndex + 1) % items.length;
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            open = true;
            activeIndex = (activeIndex - 1 + items.length) % items.length;
        } else if (e.key === 'Enter' && open && activeIndex >= 0) {
            e.preventDefault();
            choose(items[activeIndex]);
        }
    }
</script>

<div class="combobox">
    <label for={id} class={labelHidden ? 'visually-hidden' : 'field-label'}>{label}</label>
    <input
        {id}
        type="text"
        role="combobox"
        autocomplete="off"
        aria-autocomplete="list"
        aria-controls={listboxId}
        aria-expanded={open}
        aria-activedescendant={open && activeIndex >= 0 ? optionId(activeIndex) : undefined}
        {placeholder}
        bind:value
        oninput={() => onInput?.(value)}
        onkeydown={onKeyDown}
        onfocus={() => (open = items.length > 0)}
        onblur={() => (open = false)}
    />
    <ul id={listboxId} role="listbox" aria-label={label} class="listbox" hidden={!open}>
        {#each items as item, i (i)}
            <!-- Keyboard use goes through the input (combobox pattern), so options need no key handlers. -->
            <!-- svelte-ignore a11y_click_events_have_key_events -->
            <li
                id={optionId(i)}
                role="option"
                aria-selected={i === activeIndex}
                class:active={i === activeIndex}
                onmousedown={(e) => e.preventDefault()}
                onclick={() => choose(item)}
            >
                {@render option(item)}
            </li>
        {/each}
    </ul>
    <p class="visually-hidden" role="status">{status}</p>
</div>

<style>
    .combobox { position: relative; width: 100%; }
    .field-label { display: block; font-size: 0.85rem; margin-bottom: 0.35rem; opacity: 0.9; }
    .listbox {
        position: absolute;
        z-index: 10;
        top: 100%;
        left: 0;
        right: 0;
        margin: 0.35rem 0 0;
        padding: 0.25rem;
        list-style: none;
        display: grid;
        gap: 0.25rem;
        max-height: 260px;
        overflow-y: auto;
        background: var(--surface-strong);
        border: 1px solid var(--border);
        border-radius: 12px;
        box-shadow: 0 10px 30px rgba(0, 0, 0, 0.3);
    }
    .listbox[hidden] { display: none; }
    li {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 0.75rem;
        padding: 0.55rem 0.75rem;
        border-radius: 8px;
        border: 1px solid transparent;
        cursor: pointer;
        color: var(--text-primary);
    }
    li:hover { background: var(--surface); }
    li.active { border-color: var(--text-accent); background: var(--surface); }
</style>
