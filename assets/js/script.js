/* Nav: scroll suave + enlace activo + sombra al hacer scroll */
(function(){
    const nav = document.getElementById('nav');
    const links = Array.from(document.querySelectorAll('#navLinks .nav-link'));
    const sections = ['home','about','products','contact'].map(id=>document.getElementById(id));
  
    function onScroll(){
      if(window.scrollY>50){ nav.classList.add('scrolled'); } else { nav.classList.remove('scrolled'); }
      const mid = window.scrollY + window.innerHeight/2;
      let active = 0;
      sections.forEach((sec,i)=>{
        const top = sec.offsetTop, bottom = top + sec.offsetHeight;
        if(mid >= top && mid < bottom){ active = i; }
      });
      links.forEach((a,i)=>a.classList.toggle('active', i===active));
    }
  
    onScroll();
    window.addEventListener('scroll', onScroll, {passive:true});
  
    links.forEach(a=>{
      a.addEventListener('click', e=>{
        e.preventDefault();
        const id = a.getAttribute('href').replace('#','');
        document.getElementById(id)?.scrollIntoView({behavior:'smooth'});
      });
    });
  
    document.querySelectorAll('.scroll-down').forEach(btn=>{
      btn.addEventListener('click', e=>{
        e.preventDefault();
        const id = btn.getAttribute('href').replace('#','');
        document.getElementById(id)?.scrollIntoView({behavior:'smooth'});
      });
    });
  })();
  