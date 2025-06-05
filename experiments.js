//helpers

function set_cookie(name, value, expirationDays) {
	const date = new Date();
	date.setTime(date.getTime() + (expirationDays * 24 * 60 * 60 * 1000));
	const expires = "expires=" + date.toUTCString();
	document.cookie = name + "=" + value + ";" + expires + ";path=/";
  }
  
  function get_cookie(name) {
	const cookies = document.cookie.split("; ");
	for (let i = 0; i < cookies.length; i++) {
	  const cookie = cookies[i].split("=");
	  if (cookie[0] === name) {
		return cookie[1];
	  }
	}
	return "";
  }
  
  function random_number() {
	  
	  var randomNumber = Math.random() * 10;
	  
	  return randomNumber;
  
  }
  
  // bucket
  
  function bucket_sort() {
  
	  var bucket = parseInt(get_cookie("mm_exp_bucket"));
  
	  if (!bucket) {
  
		  bucket = Math.round(random_number());
		  set_cookie("mm_exp_bucket", bucket, 365);
  
	  }
  
	  return bucket;
  
  }
  
  
  // experiment
function new_experiment(id, name, experimentCallback) {
    if (name === undefined) name = null;

    var cookie_name = "mm_exp_id_" + id;

    var exp = get_cookie(cookie_name);
    var exp_id = '';
    var variant = '';

    if (exp) {
        exp_id = exp.split(".")[0];
        variant = exp.split(".")[1];
    }

    if (exp_id !== id) {
        if (random_number() <= 5) {
            variant = 0;
        } else {
            variant = 1;
        }
        set_cookie(cookie_name, id + "." + variant, 365);
    }

    if (typeof gtag == 'function') {
        gtag("event", "experiment_impression", {
            experiment_id: id,
            experiment_variant: variant,
            experiment_name: name
        });
    } else {
        dataLayer.push({
            event: "experiment_impression",
            experiment_id: id,
            experiment_variant: variant,
            experiment_name: name
        });
    }

    if (variant == '0') {
        if (typeof experiment_original !== 'undefined') {
            console.log('test0');
            experiment_original();
        }
    }

    if (variant == '1') {
        console.log('test1');
        experimentCallback(id);
    }
}
