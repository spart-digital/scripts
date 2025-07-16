## SPART Mkt Tracker

```html
<script type="text/javascript">
 
var sptr = document.createElement("script");
sptr.src = "https://cdn.jsdelivr.net/gh/spart-digital/scripts@main/spart_mkt_tracker.js";
sptr.onload = function() {
    // alterar domínio e measurement id do GA
    spart_mkt_tracker('site.com.br', 'G-XXXXXXXX');
};
document.head.appendChild(sptr);
  
</script>
```
