<script lang="ts">
  import '../styles.css';
  // The console skin: colour, type and borders only. Loaded after the layout so a
  // surface rule never has to out-specify the geometry it sits on.
  import '../theme.css';
  let { children } = $props();
</script>

{@render children()}
