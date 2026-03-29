def phase_data_validation(data_dir, modality):
    """Validate dataset and return audit information."""
    from pathlib import Path
    import logging
    from collections import Counter
    from datasets import load_dataset
    
    audit = {
        'path': data_dir,
        'modality': modality,
        'total_samples': 0,
        'n_classes': 0,
        'class_counts': {},
        'min_per_class': 0,
        'balanced': False,
        'error': None
    }
    
    # Check if data_dir is a local path that exists
    if Path(data_dir).exists():
        # Existing local path handling logic here
        # ... (keep existing code for local files)
        pass
    else:
        try:
            # Assume it's a HuggingFace dataset name
            ds = load_dataset(data_dir, split='train[:100]')
            
            # Get class names and counts
            class_names = ds.features['label'].names
            labels = ds['label']
            class_counts = Counter(labels)
            
            # Calculate metrics
            min_samples = min(class_counts.values())
            is_balanced = all(count == min_samples for count in class_counts.values())
            
            # Update audit dict
            audit.update({
                'n_classes': len(class_names),
                'total_samples': len(ds),
                'class_counts': class_counts,
                'min_per_class': min_samples,
                'balanced': is_balanced,
                'error': None
            })
            
        except Exception as e:
            audit['error'] = f'Failed to load dataset: {str(e)}'
            logging.error(f"Data validation error: {audit['error']}")
    
    return audit